const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export const MenuIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...base}><path d="M4 8h16M4 16h16" /></svg>
)
export const CloseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const PhoneIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth="1.5" {...base}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
)
export const TabletIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth="1.5" {...base}><rect x="4" y="2.5" width="16" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
)
export const LaptopIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth="1.5" {...base}><rect x="4" y="4" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>
)
export const ChatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...base}><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z" /></svg>
)
export const MailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...base}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
)
export const PinIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...base}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
)
export const ClockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
export const CheckIcon = ({ size = 26, color = '#2E7D4F' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="2.5" {...base} stroke={color}><path d="M5 12l5 5L20 7" /></svg>
)
