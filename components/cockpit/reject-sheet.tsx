"use client";

/**
 * Reject/cancel reason sheet (BRIEF B7): opens anchored to the pressed
 * card's action (BottomSheet nascent from the trigger, spring-sheet),
 * offering the four reasons. Choosing one collapses the card and starts
 * the 5 s "Desfazer" window — the server call only goes out after it.
 */

import { useTranslations } from "next-intl";
import { CircleOff, FileQuestion, History, Shuffle } from "lucide-react";
import type { RejectReason } from "@/lib/domain/types";
import type { StaffRequestPayload } from "@/lib/realtime/events";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Pressable } from "@/components/ui/pressable";

const REASON_ICONS = {
  off_style: Shuffle,
  missing_track: FileQuestion,
  already_played: History,
  other: CircleOff,
} as const;

const REASONS: RejectReason[] = [
  "off_style",
  "missing_track",
  "already_played",
  "other",
];

export interface RejectSheetProps {
  /** The card being declined — null closes the sheet. */
  request: StaffRequestPayload | null;
  mode: "reject" | "cancel";
  onClose: () => void;
  onReason: (requestId: string, reason: RejectReason) => void;
}

export function RejectSheet({ request, mode, onClose, onReason }: RejectSheetProps) {
  const t = useTranslations("cockpit.rejectSheet");

  return (
    <BottomSheet
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={mode === "reject" ? t("title") : t("titleCancel")}
      description={
        request
          ? t("description", {
              track: request.trackTitle,
              artist: request.trackArtist,
            })
          : undefined
      }
    >
      <div className="flex flex-col gap-2 pb-2 pt-1">
        {REASONS.map((reason) => {
          const Icon = REASON_ICONS[reason];
          return (
            <Pressable
              key={reason}
              onPress={() => {
                if (!request) return;
                onReason(request.requestId, reason);
                onClose();
              }}
              className="flex min-h-14 items-center gap-3 rounded-button border border-line-subtle bg-surface-2 px-4 text-left text-base font-semibold text-text-primary data-pressed:bg-surface-3"
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden className="text-text-secondary" />
              {t(`reasons.${reason}`)}
            </Pressable>
          );
        })}
        <p className="mt-2 text-sm text-text-tertiary">{t("refundNote")}</p>
      </div>
    </BottomSheet>
  );
}
