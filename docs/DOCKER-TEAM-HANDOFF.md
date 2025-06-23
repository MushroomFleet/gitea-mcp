# Docker & Deployment Team Handoff: Gitea-MCP

## Overview

This document provides comprehensive deployment, containerization, and CI/CD specifications for the Gitea-MCP TypeScript server. The deployment team should implement production-ready containerization, orchestration, and automated deployment pipelines.

## Docker Configuration

### Dockerfile

```dockerfile
# Multi-stage build for optimized production image
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS runtime

# Create non-root user for security
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001

# Set working directory
WORKDIR /app

# Copy built application and production dependencies
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create directory for logs and ensure proper permissions
RUN mkdir -p /app/logs && \
    chown -R mcp:mcp /app

# Expose port (though MCP typically uses stdio)
EXPOSE 8080

# Switch to non-root user
USER mcp

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Set default command
CMD ["node", "build/index.js"]
```

### Docker Compose Configuration

**docker-compose.yml**
```yaml
version: '3.8'

services:
  gitea-mcp:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
    container_name: gitea-mcp
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    env_file:
      - .env.production
    volumes:
      - ./logs:/app/logs
      - ./config:/app/config:ro
    networks:
      - mcp-network
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('Health check passed')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

  # Optional: Gitea instance for testing
  gitea-test:
    image: gitea/gitea:latest
    container_name: gitea-test
    restart: unless-stopped
    environment:
      - USER_UID=1000
      - USER_GID=1000
      - GITEA__security__INSTALL_LOCK=true
      - GITEA__security__SECRET_KEY=test-secret-key-change-in-production
    ports:
      - "3000:3000"
      - "222:22"
    volumes:
      - gitea-data:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    networks:
      - mcp-network

volumes:
  gitea-data:
    driver: local

networks:
  mcp-network:
    driver: bridge
```

**docker-compose.dev.yml**
```yaml
version: '3.8'

services:
  gitea-mcp-dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: gitea-mcp-dev
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug
    env_file:
      - .env.development
    volumes:
      - .:/app
      - /app/node_modules
    ports:
      - "9229:9229"  # Debug port
    command: npm run dev
    networks:
      - mcp-network
```

### Development Dockerfile

**Dockerfile.dev**
```dockerfile
FROM node:18-alpine

# Install development tools
RUN apk add --no-cache git

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Expose debug port
EXPOSE 9229

# Default command for development
CMD ["npm", "run", "dev"]
```

## Kubernetes Deployment

### Namespace Configuration

**k8s/namespace.yml**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: gitea-mcp
  labels:
    name: gitea-mcp
    environment: production
```

### ConfigMap and Secrets

**k8s/configmap.yml**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: gitea-mcp-config
  namespace: gitea-mcp
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  GITEA_TIMEOUT: "30000"
  GITEA_MAX_RETRIES: "3"
  MAX_FILE_SIZE: "10485760"
  MAX_FILES: "100"
  BATCH_SIZE: "10"
```

**k8s/secret.yml**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: gitea-mcp-secrets
  namespace: gitea-mcp
type: Opaque
data:
  # Base64 encoded values
  gitea-instances: <base64-encoded-gitea-instances-json>
stringData:
  # Example secret (replace with actual values)
  GITEA_INSTANCES: |
    [
      {
        "id": "production",
        "name": "Production Gitea",
        "baseUrl": "https://gitea.company.com",
        "token": "your-production-token",
        "timeout": 30000,
        "rateLimit": {
          "requests": 100,
          "windowMs": 60000
        }
      }
    ]
```

### Deployment Configuration

**k8s/deployment.yml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitea-mcp
  namespace: gitea-mcp
  labels:
    app: gitea-mcp
    version: v1.0.0
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: gitea-mcp
  template:
    metadata:
      labels:
        app: gitea-mcp
        version: v1.0.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: gitea-mcp
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
      - name: gitea-mcp
        image: gitea-mcp:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 8080
          name: http
          protocol: TCP
        env:
        - name: NODE_ENV
          valueFrom:
            configMapKeyRef:
              name: gitea-mcp-config
              key: NODE_ENV
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: gitea-mcp-config
              key: LOG_LEVEL
        - name: GITEA_INSTANCES
          valueFrom:
            secretKeyRef:
              name: gitea-mcp-secrets
              key: GITEA_INSTANCES
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
            ephemeral-storage: "100Mi"
          limits:
            memory: "512Mi"
            cpu: "500m"
            ephemeral-storage: "1Gi"
        livenessProbe:
          exec:
            command:
            - node
            - -e
            - "console.log('Health check passed')"
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          exec:
            command:
            - node
            - -e
            - "console.log('Ready check passed')"
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          runAsUser: 1001
          capabilities:
            drop:
            - ALL
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: logs
          mountPath: /app/logs
      volumes:
      - name: tmp
        emptyDir: {}
      - name: logs
        emptyDir: {}
      nodeSelector:
        kubernetes.io/os: linux
      tolerations:
      - key: "node-role.kubernetes.io/spot"
        operator: "Equal"
        value: "true"
        effect: "NoSchedule"
```

### Service Configuration

**k8s/service.yml**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: gitea-mcp-service
  namespace: gitea-mcp
  labels:
    app: gitea-mcp
spec:
  type: ClusterIP
  ports:
  - port: 8080
    targetPort: 8080
    protocol: TCP
    name: http
  selector:
    app: gitea-mcp
```

### Horizontal Pod Autoscaler

**k8s/hpa.yml**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: gitea-mcp-hpa
  namespace: gitea-mcp
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: gitea-mcp
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

### Service Account and RBAC

**k8s/rbac.yml**
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitea-mcp
  namespace: gitea-mcp
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: gitea-mcp
  name: gitea-mcp-role
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["configmaps", "secrets"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gitea-mcp-rolebinding
  namespace: gitea-mcp
subjects:
- kind: ServiceAccount
  name: gitea-mcp
  namespace: gitea-mcp
roleRef:
  kind: Role
  name: gitea-mcp-role
  apiGroup: rbac.authorization.k8s.io
```

### Network Policy

**k8s/network-policy.yml**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: gitea-mcp-network-policy
  namespace: gitea-mcp
spec:
  podSelector:
    matchLabels:
      app: gitea-mcp
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to: []
    ports:
    - protocol: TCP
      port: 443  # HTTPS to Gitea instances
    - protocol: TCP
      port: 53   # DNS
    - protocol: UDP
      port: 53   # DNS
```

## CI/CD Pipeline Configuration

### GitHub Actions

**.github/workflows/ci.yml**
```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
    tags: ['v*']
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linting
        run: npm run lint
      
      - name: Run type checking
        run: npm run type-check
      
      - name: Run unit tests
        run: npm run test:coverage
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
      
      - name: Build application
        run: npm run build
      
      - name: Archive build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: build-files
          path: build/

  security:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Run security audit
        run: npm audit --audit-level=high
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high
      
      - name: Run CodeQL analysis
        uses: github/codeql-action/analyze@v2

  build-and-push:
    needs: [test, security]
    runs-on: ubuntu-latest
    if: github.event_name != 'pull_request'
    outputs:
      image-digest: ${{ steps.build.outputs.digest }}
      image-uri: ${{ steps.build.outputs.image-uri }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Log in to Container Registry
        uses: docker/login-action@v2
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v4
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      
      - name: Build and push Docker image
        id: build
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64

  deploy-staging:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment: staging
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Deploy to staging
        run: |
          echo "Deploying to staging environment"
          # Add staging deployment commands here
          kubectl set image deployment/gitea-mcp gitea-mcp=${{ needs.build-and-push.outputs.image-uri }}@${{ needs.build-and-push.outputs.image-digest }} -n gitea-mcp-staging

  deploy-production:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    environment: production
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          method: kubeconfig
          kubeconfig: ${{ secrets.KUBE_CONFIG }}
      
      - name: Deploy to production
        run: |
          echo "Deploying to production environment"
          kubectl set image deployment/gitea-mcp gitea-mcp=${{ needs.build-and-push.outputs.image-uri }}@${{ needs.build-and-push.outputs.image-digest }} -n gitea-mcp
          kubectl rollout status deployment/gitea-mcp -n gitea-mcp --timeout=300s
      
      - name: Run post-deployment tests
        run: |
          # Add production smoke tests
          echo "Running post-deployment verification"
```

### GitLab CI/CD

**.gitlab-ci.yml**
```yaml
stages:
  - test
  - security
  - build
  - deploy-staging
  - deploy-production

variables:
  DOCKER_DRIVER: overlay2
  DOCKER_TLS_CERTDIR: "/certs"

before_script:
  - docker info

test:
  stage: test
  image: node:18-alpine
  cache:
    key: npm-$CI_COMMIT_REF_NAME
    paths:
      - node_modules/
  script:
    - npm ci
    - npm run lint
    - npm run type-check
    - npm run test:coverage
    - npm run build
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
    paths:
      - build/
    expire_in: 1 day

security:
  stage: security
  image: node:18-alpine
  script:
    - npm audit --audit-level=high
  allow_failure: false

build:
  stage: build
  image: docker:latest
  services:
    - docker:dind
  variables:
    IMAGE_TAG: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - docker build -t $IMAGE_TAG .
    - docker push $IMAGE_TAG
  only:
    - main
    - develop
    - tags

deploy-staging:
  stage: deploy-staging
  image: kubectl:latest
  script:
    - kubectl set image deployment/gitea-mcp gitea-mcp=$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA -n gitea-mcp-staging
    - kubectl rollout status deployment/gitea-mcp -n gitea-mcp-staging
  environment:
    name: staging
    url: https://staging.gitea-mcp.example.com
  only:
    - develop

deploy-production:
  stage: deploy-production
  image: kubectl:latest
  script:
    - kubectl set image deployment/gitea-mcp gitea-mcp=$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA -n gitea-mcp
    - kubectl rollout status deployment/gitea-mcp -n gitea-mcp
  environment:
    name: production
    url: https://gitea-mcp.example.com
  when: manual
  only:
    - tags
```

## Monitoring and Observability

### Prometheus Configuration

**monitoring/prometheus.yml**
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "gitea-mcp-rules.yml"

scrape_configs:
  - job_name: 'gitea-mcp'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - gitea-mcp
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - action: labelmap
        regex: __meta_kubernetes_pod_label_(.+)
      - source_labels: [__meta_kubernetes_namespace]
        action: replace
        target_label: kubernetes_namespace
      - source_labels: [__meta_kubernetes_pod_name]
        action: replace
        target_label: kubernetes_pod_name
```

### Grafana Dashboard

**monitoring/grafana-dashboard.json**
```json
{
  "dashboard": {
    "id": null,
    "title": "Gitea MCP Server Metrics",
    "tags": ["gitea", "mcp"],
    "timezone": "browser",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(mcp_tool_calls_total[5m])",
            "legendFormat": "{{tool_name}}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(mcp_tool_errors_total[5m])",
            "legendFormat": "{{tool_name}} - {{error_type}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(mcp_tool_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          },
          {
            "expr": "histogram_quantile(0.50, rate(mcp_tool_duration_seconds_bucket[5m]))",
            "legendFormat": "Median"
          }
        ]
      }
    ]
  }
}
```

### Alerting Rules

**monitoring/gitea-mcp-rules.yml**
```yaml
groups:
  - name: gitea-mcp
    rules:
      - alert: GiteaMCPHighErrorRate
        expr: rate(mcp_tool_errors_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected in Gitea MCP server"
          description: "Error rate is {{ $value }} errors per second"
      
      - alert: GiteaMCPHighLatency
        expr: histogram_quantile(0.95, rate(mcp_tool_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High latency detected in Gitea MCP server"
          description: "95th percentile latency is {{ $value }}s"
      
      - alert: GiteaMCPDown
        expr: up{job="gitea-mcp"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Gitea MCP server is down"
          description: "Gitea MCP server has been down for more than 1 minute"
```

## Deployment Scripts

### Kubernetes Deployment Script

**scripts/deploy-k8s.sh**
```bash
#!/bin/bash

set -euo pipefail

# Configuration
NAMESPACE="gitea-mcp"
IMAGE_TAG="${1:-latest}"
ENVIRONMENT="${2:-production}"

echo "Deploying Gitea MCP to Kubernetes..."
echo "Namespace: $NAMESPACE"
echo "Image Tag: $IMAGE_TAG"
echo "Environment: $ENVIRONMENT"

# Create namespace if it doesn't exist
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Apply configurations
kubectl apply -f k8s/configmap.yml
kubectl apply -f k8s/secret.yml
kubectl apply -f k8s/rbac.yml
kubectl apply -f k8s/network-policy.yml

# Update deployment with new image
sed "s|gitea-mcp:latest|gitea-mcp:$IMAGE_TAG|g" k8s/deployment.yml | kubectl apply -f -

# Apply services and HPA
kubectl apply -f k8s/service.yml
kubectl apply -f k8s/hpa.yml

# Wait for deployment to be ready
echo "Waiting for deployment to be ready..."
kubectl rollout status deployment/gitea-mcp -n $NAMESPACE --timeout=300s

# Verify deployment
echo "Verifying deployment..."
kubectl get pods -n $NAMESPACE -l app=gitea-mcp

echo "Deployment completed successfully!"
```

### Docker Compose Deployment Script

**scripts/deploy-docker.sh**
```bash
#!/bin/bash

set -euo pipefail

# Configuration
ENVIRONMENT="${1:-production}"
COMPOSE_FILE="docker-compose.yml"

if [ "$ENVIRONMENT" = "development" ]; then
    COMPOSE_FILE="docker-compose.dev.yml"
fi

echo "Deploying Gitea MCP with Docker Compose..."
echo "Environment: $ENVIRONMENT"
echo "Compose File: $COMPOSE_FILE"

# Build and start services
docker-compose -f $COMPOSE_FILE down
docker-compose -f $COMPOSE_FILE build --no-cache
docker-compose -f $COMPOSE_FILE up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
timeout 60 bash -c 'until docker-compose -f '$COMPOSE_FILE' ps | grep -q "healthy"; do sleep 5; done'

# Show status
docker-compose -f $COMPOSE_FILE ps

echo "Deployment completed successfully!"
```

### Health Check Script

**scripts/health-check.sh**
```bash
#!/bin/bash

set -euo pipefail

# Configuration
NAMESPACE="${1:-gitea-mcp}"
TIMEOUT="${2:-60}"

echo "Performing health check for Gitea MCP..."

# Check if pods are running
RUNNING_PODS=$(kubectl get pods -n $NAMESPACE -l app=gitea-mcp --field-selector=status.phase=Running --no-headers | wc -l)
DESIRED_REPLICAS=$(kubectl get deployment gitea-mcp -n $NAMESPACE -o jsonpath='{.spec.replicas}')

echo "Running pods: $RUNNING_PODS/$DESIRED_REPLICAS"

if [ "$RUNNING_PODS" -lt "$DESIRED_REPLICAS" ]; then
    echo "❌ Not all pods are running"
    kubectl get pods -n $NAMESPACE -l app=gitea-mcp
    exit 1
fi

# Check pod health
echo "Checking pod health..."
UNHEALTHY_PODS=$(kubectl get pods -n $NAMESPACE -l app=gitea-mcp --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].ready}{"\n"}{end}' | grep false | wc -l)

if [ "$UNHEALTHY_PODS" -gt 0 ]; then
    echo "❌ Some pods are not ready"
    kubectl get pods -n $NAMESPACE -l app=gitea-mcp
    exit 1
fi

# Check service endpoints
echo "Checking service endpoints..."
ENDPOINTS=$(kubectl get endpoints gitea-mcp-service -n $NAMESPACE -o jsonpath='{.subsets[0].addresses}' | jq length)

if [ "$ENDPOINTS" -eq 0 ]; then
    echo "❌ No service endpoints available"
    kubectl describe endpoints gitea-mcp-service -n $NAMESPACE
    exit 1
fi

echo "✅ Health check passed!"
echo "All $RUNNING_PODS pods are running and healthy"
echo "Service has $ENDPOINTS endpoints"
```

## Environment Configuration

### Production Environment Variables

**.env.production**
```bash
# Server Configuration
NODE_ENV=production
LOG_LEVEL=info

# Gitea Configuration (set via Kubernetes secrets)
# GITEA_INSTANCES will be provided via secret mount

# Upload Configuration
MAX_FILE_SIZE=10485760
MAX_FILES=100
BATCH_SIZE=10

# API Configuration
GITEA_TIMEOUT=30000
GITEA_MAX_RETRIES=3

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=8080
```

### Staging Environment Variables

**.env.staging**
```bash
# Server Configuration
NODE_ENV=staging
LOG_LEVEL=debug

# Upload Configuration
MAX_FILE_SIZE=5242880
MAX_FILES=50
BATCH_SIZE=5

# API Configuration
GITEA_TIMEOUT=15000
GITEA_MAX_RETRIES=2

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=8080
```

## Security Hardening

### Container Security

1. **Non-root User**: Container runs as non-root user (UID 1001)
2. **Read-only Root Filesystem**: Root filesystem is mounted read-only
3. **No Privilege Escalation**: Container cannot escalate privileges
4. **Dropped Capabilities**: All Linux capabilities are dropped
5. **Resource Limits**: CPU and memory limits are enforced

### Kubernetes Security

1. **Network Policies**: Restrict ingress and egress traffic
2. **RBAC**: Minimal permissions for service account
3. **Pod Security Standards**: Enforce restricted pod security standards
4. **Secrets Management**: Secure handling of sensitive configuration
5. **Image Scanning**: Automated vulnerability scanning of container images

### Build Security

1. **Multi-stage Build**: Minimize attack surface in final image
2. **Dependency Scanning**: Regular security audits of npm packages
3. **Base Image Updates**: Automated updates of base Node.js image
4. **Supply Chain Security**: Verify integrity of build artifacts

## Deployment Team Deliverables

1. **Container Infrastructure**
   - Production-ready Dockerfile with security hardening
   - Multi-environment Docker Compose configurations
   - Container registry setup and management
   - Image vulnerability scanning and updates

2. **Kubernetes Orchestration**
   - Complete Kubernetes manifests for production deployment
   - Namespace isolation and resource management
   - Horizontal pod autoscaling configuration
   - Network policies and security controls

3. **CI/CD Automation**
   - Multi-platform build and deployment pipelines
   - Automated testing integration
   - Security scanning and compliance checks
   - Blue-green or rolling deployment strategies

4. **Monitoring and Observability**
   - Metrics collection and visualization dashboards
   - Alerting rules and notification systems
   - Log aggregation and analysis setup
   - Performance monitoring and SLA tracking

5. **Operational Excellence**
   - Health check and readiness probe implementations
   - Automated backup and disaster recovery procedures
   - Rolling update and rollback strategies
   - Documentation for troubleshooting and maintenance

The deployment team should ensure all components work together seamlessly to provide a robust, secure, and maintainable production environment for the Gitea MCP server.
