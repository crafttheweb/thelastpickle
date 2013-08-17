http://groups.google.com/group/asciidoc/browse_thread/thread/142f9e3b053cad88

aarons-MBP-2011:install-tl-20111231 aaron$ sudo apt-get install texlive-latex-extra



## Installation 

aarons-MBP-2011:bin aaron$ sudo easy_install dblatex
Password:
Searching for dblatex
Reading http://pypi.python.org/simple/dblatex/
Reading http://dblatex.sf.net
Best match: dblatex 0.3.2
Downloading http://pypi.python.org/packages/source/d/dblatex/dblatex-0.3.2.tar.bz2#md5=d930bf903e445c9ffe57872b56d20934
Processing dblatex-0.3.2.tar.bz2
Running dblatex-0.3.2/setup.py -q bdist_egg --dist-dir /tmp/easy_install-ryUCnS/dblatex-0.3.2/egg-dist-tmp-QttDgJ
error: SandboxViolation: open('/dev/null', 'w') {}

The package setup script has attempted to modify files on your system
that are not within the EasyInstall build area, and has been aborted.

This package cannot be safely installed by EasyInstall, and may not
support alternate installation locations even if you run its setup
script by hand.  Please inform the package's author and the EasyInstall
maintainers to find out if a fix or workaround is available.
aarons-MBP-2011:bin aaron$ sudo easy_install dblatex=0.3.1.1
error: Not a URL, existing file, or requirement spec: 'dblatex=0.3.1.1'
aarons-MBP-2011:bin aaron$ sudo easy_install "dblatex=0.3.1.1"
error: Not a URL, existing file, or requirement spec: 'dblatex=0.3.1.1'
aarons-MBP-2011:bin aaron$ sudo easy_install -f http://pypi.python.org/pypi/dblatex/0.3.1.1 dblatex
Searching for dblatex
Reading http://pypi.python.org/pypi/dblatex/0.3.1.1
Best match: dblatex 0.3.1.1
Downloading http://pypi.python.org/packages/source/d/dblatex/dblatex-0.3.1.1.tar.bz2#md5=1b45644afa1cb4b9d3886017115bcf77
Processing dblatex-0.3.1.1.tar.bz2
Running dblatex-0.3.1.1/setup.py -q bdist_egg --dist-dir /tmp/easy_install-9NGGnJ/dblatex-0.3.1.1/egg-dist-tmp-tZmB9I
warning: no files found matching 'setup.cfg'
/bin/sh: kpsewhich: command not found
/System/Library/Frameworks/Python.framework/Versions/2.7/share/dblatex
zip_safe flag not set; analyzing archive contents...
dbtexmf.core.sgmlxml: module references __file__
dbtexmf.dblatex.grubber.plugins: module references __file__
dbtexmf.xslt.xslt: module references __file__
Adding dblatex 0.3.1.1 to easy-install.pth file
Installing dblatex script to /usr/local/bin

Installed /Library/Python/2.7/site-packages/dblatex-0.3.1.1-py2.7.egg
Processing dependencies for dblatex
Finished processing dependencies for dblatex
aarons-MBP-2011:bin aaron$ 


## issues

###  warning: failed to load external entity "http://www.oasis-open.org/docbook/xml/4.5/docbookx.dtd"

seen here https://github.com/nmathewson/libevent-book/issues/3

Check the pre-reqs for a2x 
http://www.methods.co.nz/asciidoc/a2x.1.html

Fix here
http://francisshanahan.com/index.php/2011/fixing-epub-problem-docbook-xsl-asciidoc-a2x/

I just removed the xml check --no-xmllint