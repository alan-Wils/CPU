export type PeerNotificationKind = "task" | "order" | "climate";

export type PeerNotificationItem = {
  id: string;
  kind: PeerNotificationKind;
  message: string;
  at: string;
  read: boolean;
};
