/** Read API JSON without leaking proxy/error-page HTML into the interface. */
export class ApiResponseError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

const htmlErrorMessage = (status: number): string => {
  if (status === 401 || status === 403) {
    return "The paper-market service denied access. Refresh the page and check that you’re signed in with access to this app.";
  }
  if (status === 404) {
    return "The paper-market API route could not be found. Refresh the page; if this continues, the app deployment may need repair.";
  }
  if (status === 429) {
    return "The paper-market service is receiving too many requests. Wait a moment, then refresh.";
  }
  if (status >= 500) {
    return `The paper-market service returned a temporary error (HTTP ${status}). Wait a moment, then refresh.`;
  }
  return `The paper-market service returned a web page instead of data (HTTP ${status}). Refresh the page and check your access.`;
};

/**
 * Parse an API response while retaining its HTTP status on failures. Callers
 * can use that status for account recovery and safe trade retry behavior.
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiResponseError("The paper-market response could not be read. Refresh and try again.", response.status);
  }

  const trimmed = text.trimStart();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const looksLikeHtml = contentType.includes("text/html") || /^<(?:!doctype\s+html|html\b)/i.test(trimmed);
  if (looksLikeHtml) {
    throw new ApiResponseError(htmlErrorMessage(response.status), response.status);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const message = response.status >= 500
      ? `The paper-market service returned an incomplete response (HTTP ${response.status}). Wait a moment, then refresh.`
      : "The paper-market service returned invalid data. Refresh the page and try again.";
    throw new ApiResponseError(message, response.status);
  }
}
