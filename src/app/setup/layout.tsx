import AuthProvider from "@/components/AuthProvider";

export default function Layout({ children }: LayoutProps<"/setup">) {
  return <AuthProvider>{children}</AuthProvider>;
}
