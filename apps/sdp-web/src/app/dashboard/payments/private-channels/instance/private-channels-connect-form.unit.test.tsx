import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PrivateChannelsConnectForm } from "./private-channels-connect-form";

vi.mock("@/components/ui/modal", () => ({
  Modal: () => null,
}));

vi.mock("./actions", () => ({
  connectPrivateChannelAction: vi.fn(),
  deletePrivateChannelAction: vi.fn(),
  disconnectPrivateChannelAction: vi.fn(),
  testConnectionAction: vi.fn(),
}));

it("disables every connection field when the user cannot manage the instance", () => {
  const html = renderToStaticMarkup(
    <PrivateChannelsConnectForm initialInstance={null} canManage={false} />
  );
  const authInput = html.match(/<input(?=[^>]*id="auth-url")[^>]*>/)?.[0];

  expect(authInput).toBeDefined();
  expect(authInput).toContain('disabled=""');
});
