export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  time: number;
}

export function watchGps(
  onFix: (fix: Fix) => void,
  onError: (message: string) => void,
): number {
  return navigator.geolocation.watchPosition(
    (position) => {
      onFix({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        time: position.timestamp,
      });
    },
    (error) => onError(error.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
}

export function isPhone(): boolean {
  if (new URLSearchParams(window.location.search).has("bench")) return true;
  const mobile =
    (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
    /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return Boolean(mobile) && coarse;
}
