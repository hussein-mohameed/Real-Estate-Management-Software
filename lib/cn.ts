import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** دمج أصناف Tailwind مع حلّ التعارضات — أساس shadcn/ui. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
