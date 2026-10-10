import type { Transition } from "framer-motion"

/**
 * Motion tokens from EasyUI (https://easyui.site, MIT): soft, physical,
 * immediate and controlled. Components pick one of these instead of
 * inventing their own timing, so the whole app moves the same way.
 */
export const motionTransitions = {
  /** Tabs, accordions, content fades: settles in about 400ms with no overshoot. */
  springGentle: { type: "spring", stiffness: 170, damping: 26, mass: 0.9 } as Transition,
  /** Cards and panels: the slightest organic settle. */
  springSmooth: { type: "spring", stiffness: 200, damping: 28, mass: 0.85 } as Transition,
  /** Buttons, toggles, hover indicators: settles in about 200ms. */
  springSnappy: { type: "spring", stiffness: 380, damping: 30, mass: 0.5 } as Transition,
  /** Shared layout, such as a tab or menu indicator sliding to the active item. */
  springMorph: { type: "spring", stiffness: 220, damping: 32, mass: 1 } as Transition,
  /** Color and opacity changes. */
  easeSoft: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as Transition,
  easeFast: { duration: 0.2, ease: [0.2, 0, 0, 1] } as Transition,
}
