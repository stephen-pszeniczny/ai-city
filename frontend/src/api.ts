// Talking to the backend. Every API call goes through here.

export type Health = { status: string };

export async function getHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`Backend answered ${response.status}`);
  }
  return (await response.json()) as Health;
}
