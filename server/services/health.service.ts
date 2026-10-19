import type { HealthCheckResponse } from "@/types";

export class HealthService {
  /**
   * Retrieves the current system health status.
   * This decoupled service layer will integrate with database and external dependency
   * ping checks in future phases without altering the API route contract.
   */
  public static getHealth(): HealthCheckResponse {
    return {
      status: "ok",
      service: "email-automation-platform",
    };
  }
}
