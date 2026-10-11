"use client";

/**
 * Venue switcher (admins: every venue; managers: their venues).
 * A plain <select> inside a form posting the server action — fully
 * keyboard accessible; submits on change, Enter works via the hidden
 * submit button for no-JS parity.
 */

import { useRef } from "react";
import { switchVenueAction } from "@/app/(console)/console/_lib/actions";

export interface VenueSwitcherProps {
  venues: Array<{ id: string; name: string }>;
  activeVenueId: string | null;
  label: string;
}

export function VenueSwitcher({ venues, activeVenueId, label }: VenueSwitcherProps) {
  const formRef = useRef<HTMLFormElement>(null);
  if (venues.length === 0) return null;

  return (
    <form ref={formRef} action={switchVenueAction} className="flex flex-col gap-1.5">
      <label className="label text-text-tertiary" htmlFor="console-venue">
        {label}
      </label>
      <select
        id="console-venue"
        name="venueId"
        defaultValue={activeVenueId ?? undefined}
        onChange={() => formRef.current?.requestSubmit()}
        className="w-full rounded-button border border-line-subtle bg-surface-3 px-3
          py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25"
      >
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <button type="submit" className="sr-only">
        {label}
      </button>
    </form>
  );
}
