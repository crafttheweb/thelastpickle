# Session 2, Player 2

In [27]: player_2 = assign23.Consensus2("question_2")
In [28]: player_2.decide(1, "Up")
Out[28]: (True, u'Up')

# output from cqlsh

cqlsh:dev> select * from cf23;
 name       | element_0 | element_1 | element_2 | propose_0 | propose_1
------------+-----------+-----------+-----------+-----------+-----------
 question_1 |         0 |         1 |         1 |       Red |     Black
 question_2 |      null |         1 |         1 |      null |        Up

# Session 1, Player 1

In [24]: player_1 = assign23.Consensus2("question_2")
In [25]: player_1.decide(0, "Down")
Out[25]: (False, u'Up')

# output from cqlsh
cqlsh:dev> select * from cf23;
 name       | element_0 | element_1 | element_2 | propose_0 | propose_1
------------+-----------+-----------+-----------+-----------+-----------
 question_1 |         0 |         1 |         1 |       Red |     Black
 question_2 |         0 |         0 |         1 |      Down |        Up