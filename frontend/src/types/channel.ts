export interface Channel {
  id: string;
  accountId: string;
  title: string;
  hlsStream: string;
  hlsMaster: string;
  preview: string;
  posterUrl: string;
  archive: boolean;
}
