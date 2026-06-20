pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 20, unit: 'MINUTES')
  }

  environment {
    IMAGE_NAME = 'fridge-companion'
    CONTAINER_NAME = 'fridge-companion'
    // Host port -> container port 3000. Change the left side to expose elsewhere.
    HOST_PORT = '3000'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Build image') {
      steps {
        script {
          try {
            withCredentials([
              string(credentialsId: 'supabase-url', variable: 'NEXT_PUBLIC_SUPABASE_URL'),
              string(credentialsId: 'supabase-anon-key', variable: 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
            ]) {
              // NEXT_PUBLIC_* must be passed as build args — they are inlined
              // into the client bundle at build time, not read at runtime.
              sh '''
                docker build \
                  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
                  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
                  -t "$IMAGE_NAME:$BUILD_NUMBER" \
                  -t "$IMAGE_NAME:latest" \
                  .
              '''
            }
          } catch (e) {
            error("Missing Jenkins credentials. Create Secret text entries with IDs 'supabase-url' and 'supabase-anon-key'. Original error: ${e.message}")
          }
        }
      }
    }

    stage('Deploy') {
      steps {
        // Replace the running container with the freshly built image.
        sh '''
          docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
          docker run -d \
            --name "$CONTAINER_NAME" \
            --restart unless-stopped \
            -p "$HOST_PORT":3000 \
            "$IMAGE_NAME:latest"
        '''
      }
    }

    stage('Health check') {
      steps {
        // App protects routes via proxy, so / returns a 307 redirect to /login
        // for unauthenticated requests — that's a healthy response.
        sh '''
          for i in $(seq 1 15); do
            code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$HOST_PORT/login" || true)
            if [ "$code" = "200" ]; then
              echo "App is up (/login -> $code)"
              exit 0
            fi
            echo "Waiting for app... ($i) got: $code"
            sleep 2
          done
          echo "App did not become healthy in time"
          docker logs --tail 50 "$CONTAINER_NAME" || true
          exit 1
        '''
      }
    }
  }

  post {
    success {
      echo "Deployed $IMAGE_NAME:$BUILD_NUMBER on http://localhost:${HOST_PORT}"
    }
    failure {
      script {
        if (fileExists('Jenkinsfile')) {
          sh 'docker logs --tail 80 "$CONTAINER_NAME" 2>/dev/null || true'
        } else {
          echo 'Skipping container logs because no workspace is available.'
        }
      }
    }
    always {
      script {
        if (fileExists('Jenkinsfile')) {
          // Drop dangling images from previous builds.
          sh 'docker image prune -f || true'
        } else {
          echo 'Skipping docker cleanup because no workspace is available.'
        }
      }
    }
  }
}
