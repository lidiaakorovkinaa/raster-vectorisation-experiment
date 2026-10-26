import { useEffect, useState } from 'react';
import type { TabId } from '@/types';

export type Route =
  | { name: 'home' }
  | { name: 'new'; sample?: string }
  | { name: 'experiment'; id: string; tab: TabId }
  | { name: 'series'; batch?: string }
  | { name: 'methodology' };

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'new') return { name: 'new', sample: query.get('sample') || undefined };
  if (parts[0] === 'series') return { name: 'series', batch: query.get('batch') || undefined };
  if (parts[0] === 'methodology') return { name: 'methodology' };
  if (parts[0] === 'experiment' && parts[1]) {
    const tab = (['compare', 'metrics', 'diff', 'report'] as TabId[]).includes(parts[2] as TabId) ? (parts[2] as TabId) : 'compare';
    return { name: 'experiment', id: parts[1], tab };
  }
  return { name: 'home' };
}

export function navigate(path: string) {
  if (location.hash === `#${path}`) return;
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function routeToHash(route: Route): string {
  if (route.name === 'home') return '/';
  if (route.name === 'new') return `/new${route.sample ? `?sample=${route.sample}` : ''}`;
  if (route.name === 'experiment') return `/experiment/${route.id}/${route.tab}`;
  if (route.name === 'series') return `/series${route.batch ? `?batch=${route.batch}` : ''}`;
  return '/methodology';
}
