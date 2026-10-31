import { requestUrl } from 'obsidian';
import { parseGraph, type GraphResponse } from './graph-parse';
import { parseRelated, type RelatedResponse } from './parse';

export class RelatedError extends Error {
  constructor(readonly status: number) {
    super('Related notes request failed');
  }
}

/** Related data request. Never expose request details in errors. */
export async function fetchRelated(
  serverUrl: string,
  token: string,
  path: string,
  k: number
): Promise<RelatedResponse> {
  try {
    const response = await requestUrl({
      url: `${serverUrl.replace(/\/+$/, '')}/api/related?path=${encodeURIComponent(path)}&k=${k}`,
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    });
    if (response.status !== 200) throw new RelatedError(response.status);
    return parseRelated(response.json);
  } catch (error) {
    if (error instanceof RelatedError) throw error;
    throw new RelatedError(0);
  }
}

/** Read-only graph fetch; browsing does not record learning events. */
export async function fetchGraph(serverUrl: string, token: string): Promise<GraphResponse> {
  try {
    const response = await requestUrl({
      url: `${serverUrl.replace(/\/+$/, '')}/api/graph`,
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    });
    if (response.status !== 200) throw new RelatedError(response.status);
    return parseGraph(response.json);
  } catch (error) {
    if (error instanceof RelatedError) throw error;
    throw new RelatedError(0);
  }
}
