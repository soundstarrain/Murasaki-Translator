import * as React from "react"
import { cn } from "../../lib/utils"

// --- Card Component ---
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }

// --- Button Component ---
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
                destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
                outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
                secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
                ghost: "hover:bg-accent hover:text-accent-foreground",
                link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9 px-4 py-2",
                sm: "h-8 rounded-md px-3 text-xs",
                lg: "h-10 rounded-md px-8",
                icon: "h-9 w-9",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }

// --- Switch Component ---
const Switch = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { checked?: boolean, onCheckedChange?: (checked: boolean) => void }>(
    ({ className, checked, onCheckedChange, ...props }, ref) => (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            ref={ref}
            onClick={() => onCheckedChange?.(!checked)}
            className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                checked ? "bg-primary" : "bg-input",
                className
            )}
            {...props}
        >
            <span
                className={cn(
                    "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                    checked ? "translate-x-4" : "translate-x-0"
                )}
            />
        </button>
    )
)
Switch.displayName = "Switch"

export { Switch }

// --- Slider Component ---
const Slider = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <div className="relative flex w-full touch-none select-none items-center">
        <input
            type="range"
            ref={ref}
            className={cn(
                "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted border border-border/50 accent-primary transition-all",
                "[&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:rounded-full",
                "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background",
                "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
                className
            )}
            {...props}
        />
    </div>
))
Slider.displayName = "Slider"

export { Slider }
