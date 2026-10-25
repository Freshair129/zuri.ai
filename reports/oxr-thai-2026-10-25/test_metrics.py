"""Independent small oracle checks for measurement math, not product acceptance."""
import itertools, unittest
from evaluate import distance, canonical, supports

def slow(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        previous=row;row=[i]
        for j,y in enumerate(b,1):row.append(min(row[-1]+1,previous[j]+1,previous[j-1]+(x!=y)))
    return row[-1]

class MetricsTests(unittest.TestCase):
    def test_edit_distance_against_matrix_oracle(self):
        strings=[''.join(x) for n in range(4) for x in itertools.product('กa',repeat=n)]
        for a in strings:
            for b in strings:self.assertEqual(distance(a,b),slow(a,b),(a,b))
        self.assertEqual(distance('แมว','แมวแมวแมว'),6)
    def test_normalization_does_not_hide_corrupt_marks(self):
        self.assertEqual(canonical('ก ข\nค'),'กขค')
        self.assertNotEqual(canonical('น้ำ'),canonical('น\0ำ'))
    def test_table_support_requires_row_association(self):
        d={'table':{'rows':[['SKU1','แก้ว','10'],['SKU2','ถ้วย','20']]}}
        q={'evidence':['SKU1','10']}
        self.assertTrue(supports('SKU1 | แก้ว | 10',d,q))
        self.assertFalse(supports('SKU1 | แก้ว | 20\nSKU2 | ถ้วย | 10',d,q))
if __name__=='__main__':unittest.main()
