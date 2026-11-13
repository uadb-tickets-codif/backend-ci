pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
  }

  environment {
    IMAGE = 'groupe9/backend'
    TAG   = "1.0.${env.BUILD_NUMBER}"
    TRIVY = 'aquasec/trivy:0.76.2'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git log -1 --oneline'
      }
    }

    stage('Installation et build') {
      steps {
        // Etape "build" du Dockerfile : npm ci, prisma generate, nest build
        sh 'docker build --target build -t backend-build:${TAG} .'
      }
    }

    stage('Tests unitaires') {
      steps {
        sh 'docker run --rm backend-build:${TAG} npm test'
      }
    }

    stage('Scan du code (npm audit)') {
      steps {
        // Echoue si une vulnerabilite HIGH ou CRITICAL est trouvee dans les dependances
        sh 'docker run --rm backend-build:${TAG} npm audit --audit-level=high'
      }
    }

    stage('Build image Docker') {
      steps {
        sh 'docker build -t ${IMAGE}:${TAG} -t ${IMAGE}:latest .'
      }
    }

    stage('Scan Trivy') {
      steps {
        // Rapport sans blocage pour l instant (les failles de l image de base
        // sont traitees dans la carte 28), puis on passera a --exit-code 1
        sh '''
          docker run --rm \
            -v /var/run/docker.sock:/var/run/docker.sock \
            -v trivy-cache:/root/.cache/ \
            ${TRIVY} image --skip-db-update --no-progress \
            --severity HIGH,CRITICAL --exit-code 0 \
            ${IMAGE}:${TAG} > trivy-report.txt
          cat trivy-report.txt
        '''
        archiveArtifacts artifacts: 'trivy-report.txt', allowEmptyArchive: true
      }
    }

    stage('Push Docker Hub') {
      when {
        anyOf { branch 'develop'; branch 'main' }
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub-creds',
                         usernameVariable: 'DH_USER', passwordVariable: 'DH_TOKEN')]) {
          sh '''
            echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin
            docker push ${IMAGE}:${TAG}
            docker push ${IMAGE}:latest
          '''
        }
      }
    }

    stage('Déclencher le déploiement') {
    when { branch 'develop' }
      steps {
        build job: '/deployment-cd',
              wait: false,
              parameters: [string(name: 'BACKEND_TAG', value: TAG)]
      }
    }
  }

  post {
    always {
      sh '''
        docker logout || true
        docker rmi backend-build:${TAG} ${IMAGE}:${TAG} ${IMAGE}:latest || true
      '''
    }
    success { echo "Pipeline termine : ${IMAGE}:${TAG}" }
    failure { echo 'Pipeline en echec : voir l etape en rouge' }
  }
}
