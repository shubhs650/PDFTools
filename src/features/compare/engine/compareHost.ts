// The app's one Compare worker client (M12-07, D-66): started with the first
// comparison, terminated when the last one closes (compareClient.ts).
import { CompareClient } from '../../../engine/compareClient';

let client: CompareClient | undefined;

export function compareClient(): CompareClient {
  client ??= new CompareClient();
  return client;
}
