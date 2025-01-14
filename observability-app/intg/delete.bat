kubectl delete -f service-nginx.yaml
kubectl delete -f services-app.yaml
kubectl delete -f deployment-nginx.yaml
kubectl delete -f deployment-app1.yaml
kubectl delete -f deployment-app2.yaml
kubectl delete -f configmap-nginx.yaml
kubectl delete -f namespace.yaml



kubectl delete -f observability-stack/loki-config.yaml -n observability-demo
kubectl delete -f observability-stack/prometheus-config.yaml -n observability-demo
kubectl delete -f observability-stack/promtail-config.yaml -n observability-demo
kubectl delete -f observability-stack/grafana-datasources.yaml -n observability-demo
kubectl delete -f observability-stack/grafana-datasource-loki.yaml -n observability-demo

kubectl delete -f observability-stack/prometheus-deployment.yaml -n observability-demo
kubectl delete -f observability-stack/loki-deployment.yaml -n observability-demo
kubectl delete -f observability-stack/promtail-daemonset.yaml -n observability-demo
kubectl delete -f observability-stack/grafana-deployment.yaml -n observability-demo
