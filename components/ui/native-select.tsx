import * as React from "react";

import { cn } from "@/lib/cn";

/**
 * قائمة اختيار **أصلية** (`<select>`) بمظهر shadcn.
 *
 * ── لماذا لا نستعمل `Select` من Radix هنا ────────────────────────────
 * `Select` من Radix مكوّن عميل يحفظ قيمته في حالة React، **ولا يُرسل
 * قيمةً في نموذج HTML عادي** ما لم يُضَف حقل مخفي بجانبه. شاشات الترشيح
 * عندنا نماذج `GET` بلا JavaScript: المرشّحات تعيش في عنوان الصفحة، فهي
 * قابلة للمشاركة والرجوع والفتح في تبويب جديد — وهذا مقصود.
 *
 * فاستعمال Radix هنا كان سيكسر الترشيح صامتاً مقابل مظهر أجمل. القائمة
 * الأصلية أيضاً أفضل على الهاتف: تفتح منتقي النظام.
 *
 * ‏`Select` من Radix يبقى للاستعمال داخل النماذج التفاعلية (حوارات
 * الإنشاء والتعديل) حيث توجد حالة عميل أصلاً.
 */
function NativeSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs",
        "transition-[color,box-shadow] outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "md:text-sm dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
