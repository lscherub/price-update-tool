import { HelpCenterClient } from "@/components/help/HelpCenterClient";

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HelpCenterClient initialSlug={decodeURIComponent(slug)} />;
}
