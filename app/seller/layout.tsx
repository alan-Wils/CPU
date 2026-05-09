import SellerHubLayoutClient from "@/components/seller/SellerHubLayoutClient";

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return <SellerHubLayoutClient>{children}</SellerHubLayoutClient>;
}
