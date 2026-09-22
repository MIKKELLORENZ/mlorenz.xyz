"""splice.py TARGET MARKER PARTFILE — replace the single line `/*__MARKER__*/` in TARGET
with the contents of PARTFILE, then delete PARTFILE. Build helper used while the
engine was being written in pieces; asserts the marker exists exactly once."""
import os
import sys

target, marker, part = sys.argv[1:4]
tag = '/*__%s__*/' % marker
src = open(target, encoding='utf-8').read()
body = open(part, encoding='utf-8').read()
assert src.count(tag) == 1, '%s occurs %d times in %s' % (tag, src.count(tag), target)
open(target, 'w', encoding='utf-8', newline='\n').write(src.replace(tag + '\n', body, 1))
os.remove(part)
print('spliced %d lines into %s' % (body.count('\n'), target))
