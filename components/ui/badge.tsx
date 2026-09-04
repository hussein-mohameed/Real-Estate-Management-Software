import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/cn"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",

        // ── نبرات المجال (‏§11.2) ───────────────────────────────────────
        // لغة اللون في §11.2 معلومة لا زينة، وvariants الافتراضية أعلاه
        // لا تحملها. تُضاف هنا لا في مكوّن شارة ثانٍ، كي يبقى للنظام
        // شكلُ شارة واحد: نفس الحواف والحشوة والخط.
        neutral: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
        success:
          "bg-occupancy-owner/10 text-occupancy-owner ring-1 ring-inset ring-occupancy-owner/30",
        info: "bg-occupancy-tenant/10 text-occupancy-tenant ring-1 ring-inset ring-occupancy-tenant/30",
        warning:
          "bg-money-pending/10 text-money-pending ring-1 ring-inset ring-money-pending/30",
        danger:
          "bg-money-overdue/10 text-money-overdue ring-1 ring-inset ring-money-overdue/30",
        emerald:
          "bg-construction-delivered/10 text-construction-delivered ring-1 ring-inset ring-construction-delivered/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
