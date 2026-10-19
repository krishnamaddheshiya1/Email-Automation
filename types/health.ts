export interface HealthCheckResponse {
  status: "ok" | "degraded" | "error";
  service: string;
}
