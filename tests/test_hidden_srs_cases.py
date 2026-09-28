import unittest
from scripts.analytics.hidden_case_harness import run_harness

class HiddenSRSCaseHarnessTests(unittest.TestCase):
    def test_all_named_contradictions_have_deterministic_evidence(self):
        evidence = run_harness()
        self.assertEqual(evidence["fixture_count"], 15)
        self.assertTrue(evidence["all_passed"], evidence)
        self.assertEqual(evidence["passed_count"], 15)

    def test_fixture_ids_are_unique_and_each_case_has_expected_output(self):
        evidence = run_harness()
        ids = [row["id"] for row in evidence["cases"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(row["expected_findings"] for row in evidence["cases"]))

if __name__ == "__main__":
    unittest.main()
