import { BRAND_LOGO_SRC } from "../lib/constants";

export function BrandLogo({ className = "" }) {
  return <img alt="China Southern Airlines" className={`brand-logo-img ${className}`.trim()} src={BRAND_LOGO_SRC} />;
}
