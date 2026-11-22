// Compare worker (M12-07, ARCHITECTURE §3.1, D-66, ADR-031): our own code, no
// PDFium, like the Snap worker. It holds each open comparison's material,
// transferred from the Work worker through the main thread, and does the
// comparison's work on it, so a long comparison never blocks search,
// snapping or the main thread. Every call is cancellable (rule 2); the main
// thread terminates the worker when no comparison is open, which gives its
// memory back.
import { serve } from './rpc-host';
import { compareHandlers } from './compare/handlers';
import { CompareStore } from './compare/store';

serve(self, compareHandlers(new CompareStore()));
