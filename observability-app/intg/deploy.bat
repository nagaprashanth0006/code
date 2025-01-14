kubectl apply -f namespace.yaml
kubectl apply -f configmap-nginx.yaml
kubectl apply -f deployment-app1.yaml
kubectl apply -f deployment-app2.yaml
kubectl apply -f deployment-nginx.yaml
kubectl apply -f services-app.yaml
kubectl apply -f service-nginx.yaml


kubectl apply -f observability-stack/loki-config.yaml -n observability-demo
kubectl apply -f observability-stack/prometheus-config.yaml -n observability-demo
kubectl apply -f observability-stack/promtail-config.yaml -n observability-demo
kubectl apply -f observability-stack/grafana-datasources.yaml -n observability-demo

kubectl apply -f observability-stack/prometheus-deployment.yaml -n observability-demo
kubectl apply -f observability-stack/loki-deployment.yaml -n observability-demo
kubectl apply -f observability-stack/promtail-daemonset.yaml -n observability-demo
kubectl apply -f observability-stack/grafana-deployment.yaml -n observability-demo
kubectl apply -f observability-stack/grafana-datasource-loki.yaml -n observability-demo