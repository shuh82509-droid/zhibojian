import Dashboard from "./dashboard";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = params.view === "overview" ? "overview" : "data";
  return <Dashboard initialView={view} />;
}
