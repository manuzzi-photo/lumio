"use client";

import { useParams } from "next/navigation";

import { PublicPageView } from "@/components/landing/PublicPageView";

export default function PublicLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  return <PublicPageView slug={slug} />;
}
