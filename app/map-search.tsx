"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import mapboxgl, { Marker } from "mapbox-gl";
import type { LngLatLike, Map } from "mapbox-gl";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const delhiCenter: [number, number] = [77.209, 28.6139];

type SearchResult = {
  id: string;
  place_name: string;
  center: [number, number];
};

type GeocodingResponse = {
  features?: SearchResult[];
  message?: string;
};

export default function MapSearch() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [query, setQuery] = useState("Delhi");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState("Delhi, India");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || !mapboxToken || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: delhiCenter,
      zoom: 10.8,
      pitch: 0,
      attributionControl: false
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    markerRef.current = new mapboxgl.Marker({ color: "#f5c542" })
      .setLngLat(delhiCenter)
      .addTo(map);
    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Enter a place name to search.");
      setResults([]);
      return;
    }

    if (!mapboxToken) {
      setError("Add NEXT_PUBLIC_MAPBOX_TOKEN to .env and restart npm run dev.");
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        access_token: mapboxToken,
        limit: "5",
        types: "place,locality,neighborhood,address",
        autocomplete: "true"
      });
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          trimmedQuery
        )}.json?${params.toString()}`
      );
      const data = (await response.json()) as GeocodingResponse;

      if (!response.ok) {
        throw new Error(data.message ?? "Mapbox search failed.");
      }

      const nextResults = data.features ?? [];
      setResults(nextResults);

      if (nextResults.length === 0) {
        setError("No matching places found.");
        return;
      }

      flyToResult(nextResults[0]);
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  function flyToResult(result: SearchResult) {
    setSelectedPlace(result.place_name);
    setQuery(result.place_name);
    setError(null);

    const center = result.center as LngLatLike;
    markerRef.current?.setLngLat(center);
    mapRef.current?.flyTo({
      center,
      zoom: 12.4,
      speed: 0.9,
      curve: 1.35,
      essential: true
    });
  }

  return (
    <main className="min-h-screen bg-[#111412] text-[#f7faf4]">
      <div className="grid min-h-screen lg:grid-cols-[380px_1fr]">
        <aside className="z-10 border-b border-white/10 bg-[#161a18] px-5 py-5 shadow-2xl lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#f5c542]">UrbanCanvas</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight">Map workspace</h1>
            </div>
            <span className="rounded border border-white/15 px-2.5 py-1 text-xs text-white/70">
              Milestone 2
            </span>
          </div>

          <form className="mt-8" onSubmit={handleSearch}>
            <label className="text-sm font-medium text-white/75" htmlFor="location-search">
              Search location
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="location-search"
                className="min-w-0 flex-1 rounded border border-white/15 bg-white px-3 py-2.5 text-sm text-[#111412] outline-none transition focus:border-[#f5c542] focus:ring-2 focus:ring-[#f5c542]/35"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Delhi"
                type="search"
                value={query}
              />
              <button
                className="rounded bg-[#f5c542] px-4 py-2.5 text-sm font-semibold text-[#111412] transition hover:bg-[#ffd85a] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSearching}
                type="submit"
              >
                {isSearching ? "Searching" : "Search"}
              </button>
            </div>
          </form>

          {error ? (
            <p className="mt-4 rounded border border-[#f5c542]/30 bg-[#f5c542]/10 px-3 py-2 text-sm leading-6 text-[#ffe6a1]">
              {error}
            </p>
          ) : null}

          <section className="mt-6">
            <p className="text-xs font-semibold uppercase text-white/45">Focused place</p>
            <p className="mt-2 text-sm leading-6 text-white/80">{selectedPlace}</p>
          </section>

          {results.length > 0 ? (
            <section className="mt-6">
              <p className="text-xs font-semibold uppercase text-white/45">Results</p>
              <div className="mt-3 space-y-2">
                {results.map((result) => (
                  <button
                    className="w-full rounded border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm leading-5 text-white/80 transition hover:border-[#f5c542]/50 hover:bg-white/[0.08]"
                    key={result.id}
                    onClick={() => flyToResult(result)}
                    type="button"
                  >
                    {result.place_name}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="mt-8 border-t border-white/10 pt-5 text-sm leading-6 text-white/55">
            Delhi is loaded by default.
          </div>
        </aside>

        <section className="relative min-h-[62vh] overflow-hidden bg-[#0d100f] lg:min-h-screen">
          <div ref={mapContainerRef} className="absolute inset-0" />

          {!mapboxToken ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md rounded border border-white/15 bg-[#161a18] p-5 shadow-2xl">
                <h2 className="text-xl font-semibold">Mapbox token needed</h2>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  Add your public Mapbox token to `.env` as `NEXT_PUBLIC_MAPBOX_TOKEN`,
                  then restart `npm run dev`.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
