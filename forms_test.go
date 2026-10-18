package hqpoketoken

import "testing"

func TestForms(t *testing.T) {
	f := Forms()
	if f[201]["question"] != 27 || f[492]["sky"] != 1 || f[550]["blue-striped"] != 1 {
		t.Fatalf("unexpected table: %v", f)
	}
}
