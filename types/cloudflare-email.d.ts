// Cloudflare's runtime module for Email Routing's `send_email` binding
// (https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/).
// Declared here instead of adding @cloudflare/workers-types for one class.
declare module 'cloudflare:email' {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
  }
}
