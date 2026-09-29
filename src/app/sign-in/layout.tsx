import AuthProvider from "@/components/AuthProvider";

export default function Layout({ children }: LayoutProps<"/sign-in">) {
  return <AuthProvider>{children}</AuthProvider>;
}
