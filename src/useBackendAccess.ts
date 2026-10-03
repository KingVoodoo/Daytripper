import { useEffect, useState } from 'react';
import { currentBackendAccess, watchBackendAccess } from './backend-access';

export function useBackendAccess() {
  const [access, setAccess] = useState(currentBackendAccess);
  useEffect(() => watchBackendAccess(setAccess), []);
  return access;
}
