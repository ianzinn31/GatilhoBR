import React from "react";
import { HOUSES } from "@/data/mocks/catalog";
import type { HouseId } from "@/types/gatilho";
import { cn } from "@/lib/utils";

interface HouseSelectorProps {
  selectedHouse: HouseId;
  onSelectHouse: (houseId: HouseId) => void;
  allowedHouses?: HouseId[];
  className?: string;
}

export function HouseSelector({
  selectedHouse,
  onSelectHouse,
  allowedHouses,
  className,
}: HouseSelectorProps) {
  const houses = allowedHouses?.length
    ? HOUSES.filter((house) => allowedHouses.includes(house.id))
    : HOUSES;
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-primary/20 bg-surface/90 p-1 shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--primary)_10%,transparent)] backdrop-blur-md scroll-slim",
        className,
      )}
    >
      {houses.map((house) => {
        const isSelected = selectedHouse === house.id;
        return (
          <button
            key={house.id}
            type="button"
            onClick={() => onSelectHouse(house.id)}
            title={`Alternar para ${house.name}`}
            className={cn(
              "relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-lg border px-2.5 text-xs font-semibold outline-none transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "border-primary/45 bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent)]"
                : "border-transparent text-muted-foreground hover:border-primary/15 hover:bg-primary/5 hover:text-foreground",
            )}
          >
            {/* Logo da Casa / Miniatura visual */}
            <div className="flex items-center justify-center h-4 max-w-[60px] min-w-[24px]">
              <img
                src={house.logoUrl || `./${house.id}-logo.png`}
                alt={house.name}
                className={cn(
                  "h-3.5 w-auto object-contain transition-all duration-200",
                  isSelected
                    ? "brightness-110 drop-shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
                    : "opacity-60 hover:opacity-90 grayscale-[40%]"
                )}
                onError={(e) => {
                  const target = e.currentTarget as HTMLElement;
                  target.style.display = "none";
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = "inline";
                }}
              />
              <span className="hidden text-[11px] font-bold tracking-wider text-muted-foreground">
                {house.shortName}
              </span>
            </div>

            {/* Nome da Casa */}
            <span className={cn(
              "hidden sm:inline font-bold text-[12px] tracking-tight",
              isSelected ? "text-primary" : "text-muted-foreground"
            )}>
              {house.name}
            </span>

            {/* Ponto reluzente da casa ativa */}
            {isSelected && (
              <span className="relative flex h-2 w-2 ml-0.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-65 motion-reduce:hidden"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
