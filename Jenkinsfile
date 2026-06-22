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

    stage('Check credentials') {
      steps {
        withCredentials([
          string(credentialsId: 'supabase-url', variable: 'SUPABASE_URL'),
          string(credentialsId: 'supabase-anon-key', variable: 'SUPABASE_ANON_KEY'),
        ]) {
          sh '''
            test -n "$SUPABASE_URL"
            test -n "$SUPABASE_ANON_KEY"
            echo "Credentials loaded"
          '''
        }
      }
    }

    stage('Check docker') {
      steps {
        sh '''
          if ! command -v docker >/dev/null 2>&1; then
            echo "Docker CLI is not available to Jenkins."
            echo "Install Docker CLI on the Jenkins agent, or run Jenkins with Docker socket access."
            exit 127
          fi

          docker version
          docker info >/dev/null
        '''
      }
    }

    stage('Build image') {
      steps {
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
      }
    }

    stage('Deploy') {
      steps {
        // Server-only secrets are injected at RUNTIME (docker run), never baked
        // into the image. Passing `-e VAR` without a value forwards it from the
        // (credential-masked) shell env, so the value never lands on the
        // command line or in `docker inspect` history.
        withCredentials([
          string(credentialsId: 'hermes-api-token', variable: 'HERMES_API_TOKEN'),
          string(credentialsId: 'supabase-service-role-key', variable: 'SUPABASE_SERVICE_ROLE_KEY'),
        ]) {
          // Replace the running container with the freshly built image.
          sh '''
            docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
            docker run -d \
              --name "$CONTAINER_NAME" \
              --restart unless-stopped \
              -p "$HOST_PORT":3000 \
              -e HERMES_API_TOKEN \
              -e SUPABASE_SERVICE_ROLE_KEY \
              "$IMAGE_NAME:latest"
          '''
        }
      }
    }

    stage('Health check') {
      steps {
        // Jenkins runs inside a container — localhost here is Jenkins, not the host.
        // Reach the host via its Docker bridge gateway IP.
        sh '''
          HOST_IP=$(ip route show default 2>/dev/null | awk 'NR==1{print $3}')
          : "${HOST_IP:=172.17.0.1}"
          for i in $(seq 1 15); do
            code=$(curl -s -o /dev/null -w "%{http_code}" "http://${HOST_IP}:${HOST_PORT}/login" || true)
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
          sh '''
            if command -v docker >/dev/null 2>&1; then
              docker logs --tail 80 "$CONTAINER_NAME" 2>/dev/null || true
            else
              echo "Skipping container logs because Docker CLI is unavailable."
            fi
          '''
        } else {
          echo 'Skipping container logs because no workspace is available.'
        }
      }
    }
    always {
      script {
        if (fileExists('Jenkinsfile')) {
          // Drop dangling images from previous builds.
          sh '''
            if command -v docker >/dev/null 2>&1; then
              docker image prune -f || true
            else
              echo "Skipping docker cleanup because Docker CLI is unavailable."
            fi
          '''
        } else {
          echo 'Skipping docker cleanup because no workspace is available.'
        }
      }
    }
  }
}
