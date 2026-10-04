/** StreamBird's user documentation (a section of the shared ShackyApps docs site). */
export const DOCS_URL = 'https://shackyapps.in/docs/streambird/';

export function docsUrl(page?: string): string {
  return page ? `${DOCS_URL}${page}` : DOCS_URL;
}
