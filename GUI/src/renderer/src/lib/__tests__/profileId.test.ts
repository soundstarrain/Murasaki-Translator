import { createUniqueProfileId, slugifyProfileId } from "../profileId";

describe("profileId utils", () => {
  it("slugifies profile names to safe ids", () => {
    expect(slugifyProfileId("New Profile")).toBe("new_profile");
    expect(slugifyProfileId("  API@Prod  ")).toBe("apiprod");
  });

  it("creates unique ids when collisions exist", () => {
    const existing = ["new_profile", "new_profile_2"];
    expect(createUniqueProfileId("new_profile", existing)).toBe("new_profile_3");
  });

  it("keeps current id when provided", () => {
    const existing = ["profile_a", "profile_b"];
    expect(createUniqueProfileId("profile_a", existing, "profile_a")).toBe(
      "profile_a",
    );
  });
});
