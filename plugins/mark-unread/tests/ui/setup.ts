// Testing Library unmounts between tests only when vitest globals are on, and
// they are not, so a later query would otherwise find an earlier render too.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
