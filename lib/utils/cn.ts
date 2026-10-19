/**
 * Utility function to conditionally join class names together.
 * Provides a clean and lightweight class utility without extra heavy dependencies.
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(" ");
}
