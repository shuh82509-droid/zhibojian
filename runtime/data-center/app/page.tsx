import { headers } from "next/headers";
import { integrationBaseFromPrefix } from "./integration-route";
import Dashboard from "./dashboard";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = params.view === "overview" ? "overview" : "data";
  const prefix = (await headers()).get("x-forwarded-prefix");
  return <Dashboard initialView={view} integrationBase={integrationBaseFromPrefix(prefix)} />;
}
