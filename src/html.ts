import { readFileSync } from 'fs';
import { resolve } from 'path';

const staticIndexPath = resolve('./src/static/index.html');

export function getHtmlPage(): string {
  return readFileSync(staticIndexPath, 'utf-8');
}
