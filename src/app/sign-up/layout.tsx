import AuthProvider from "@/components/AuthProvider";

export default function Layout({ children }: LayoutProps<"/sign-up">) {
  return <AuthProvider>{children}</AuthProvider>;
}
