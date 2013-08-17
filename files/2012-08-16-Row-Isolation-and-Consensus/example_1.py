# Session 1, Player 1
In [21]: player_1 = assign23.Consensus2("question_1")
In [22]: player_1.decide(0, "Red")
Out[22]: (True, u'Red')

# Output from cqlsh
cqlsh:dev> select * from cf23;
 name       | element_0 | element_1 | element_2 | propose_0 | propose_1
------------+-----------+-----------+-----------+-----------+-----------
 question_1 |         0 |         0 |      null |       Red |      null

# Session 2, Player 2
In [25]: player_2 = assign23.Consensus2("question_1")
In [26]: player_2.decide(1, "Black")
Out[26]: (False, u'Red')

# output from cqlsh
cqlsh:dev> select * from cf23;
 name       | element_0 | element_1 | element_2 | propose_0 | propose_1
------------+-----------+-----------+-----------+-----------+-----------
 question_1 |         0 |         1 |         1 |       Red |     Black
