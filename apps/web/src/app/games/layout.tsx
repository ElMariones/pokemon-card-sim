import "./arcade.css";

/**
 * The arcade's styles load with this segment and nowhere else, so the rest of
 * the app never pays for a cabinet it does not render.
 */
export default function GamesLayout({ children }: LayoutProps<"/games">) {
  return <div className="arcade">{children}</div>;
}
