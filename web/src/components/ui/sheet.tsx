import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { PortalContainerProvider } from "@/components/ui/portal-container";
import { cn } from "@/lib/utils";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

const OPEN_LAYER_SELECTOR =
    '[data-slot="select-content"], [data-slot="dropdown-menu-content"], [data-slot="popover-content"]';

function SheetOverlay({
    className,
    onClick,
    onPointerDown,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    const pressedHere = React.useRef(false);
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
                className,
            )}
            onClick={(event) => {
                // A Select list closes on pointerup, so its click lands on the overlay: only a press
                // that started on the overlay closes the sheet.
                if (!pressedHere.current) event.preventDefault();
                pressedHere.current = false;
                onClick?.(event);
                event.stopPropagation();
            }}
            onPointerDown={(event) => {
                onPointerDown?.(event);
                // With a list open the press goes to Radix, which closes the list and keeps the sheet.
                pressedHere.current = !document.querySelector(OPEN_LAYER_SELECTOR);
                if (pressedHere.current) event.stopPropagation();
            }}
            {...props}
        />
    );
}

// Radix layers are portalled outside the sheet's DOM; a click in them must not close it.
const NESTED_OVERLAY_SELECTOR =
    '[data-radix-popper-content-wrapper], [data-slot="tooltip-content"], [data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="select-content"]';

function SheetContent({
    className,
    children,
    onClick,
    onKeyDown,
    onPointerDown,
    onPointerDownOutside,
    side = "right",
    size = "default",
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
    side?: "top" | "right" | "bottom" | "left";
    size?: "default" | "wide";
    showCloseButton?: boolean;
}) {
    const t = useTranslations("web");
    const contentRef = React.useRef<HTMLDivElement | null>(null);

    return (
        <SheetPortal>
            <SheetPrimitive.Close asChild>
                <SheetOverlay />
            </SheetPrimitive.Close>
            <SheetPrimitive.Content
                ref={contentRef}
                data-slot="sheet-content"
                data-side={side}
                data-size={size}
                className={cn(
                    "fixed z-50 flex flex-col bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-full data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-full data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-lg data-[side=right]:sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
                    size === "wide" &&
                        "data-[side=left]:sm:max-w-[max(42rem,50vw)] data-[side=right]:sm:max-w-[max(42rem,50vw)]",
                    className,
                )}
                onClick={(event) => {
                    onClick?.(event);
                    event.stopPropagation();
                }}
                onPointerDownOutside={(event) => {
                    onPointerDownOutside?.(event);
                    const target = event.detail.originalEvent.target;
                    if (target instanceof Element && target.closest(NESTED_OVERLAY_SELECTOR)) {
                        event.preventDefault();
                    }
                }}
                onKeyDown={(event) => {
                    onKeyDown?.(event);
                    event.stopPropagation();
                }}
                onPointerDown={(event) => {
                    onPointerDown?.(event);
                    event.stopPropagation();
                }}
                {...props}
            >
                <PortalContainerProvider containerRef={contentRef}>
                    {children}
                    {showCloseButton && (
                        <SheetPrimitive.Close data-slot="sheet-close" asChild>
                            <Button
                                variant="ghost"
                                className="absolute top-3 right-3"
                                size="icon-sm"
                            >
                                <XIcon />
                                <span className="sr-only">{t("common.close")}</span>
                            </Button>
                        </SheetPrimitive.Close>
                    )}
                </PortalContainerProvider>
            </SheetPrimitive.Content>
        </SheetPortal>
    );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-header"
            className={cn("flex flex-col gap-0.5 p-4", className)}
            {...props}
        />
    );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-body"
            className={cn(
                "scroll-fade scroll-fade-24 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-1 px-4 pb-4",
                className,
            )}
            {...props}
        />
    );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-footer"
            className={cn("mt-auto flex flex-col gap-2 p-4", className)}
            {...props}
        />
    );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn("font-heading text-base font-medium text-foreground", className)}
            {...props}
        />
    );
}

function SheetDescription({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
    return (
        <SheetPrimitive.Description
            data-slot="sheet-description"
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export {
    Sheet,
    SheetBody,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
};
